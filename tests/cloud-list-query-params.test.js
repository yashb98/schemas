const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");
const { configureStore } = require("@reduxjs/toolkit");
const { generateEndpoints } = require("@rtk-query/codegen-openapi");
const { guardOptionalQueryParams } = require("../build/generate-rtk");

const root = path.join(__dirname, "..");
const cloudSpec = path.join(root, "_openapi_build/cloud_openapi.yml");

test("Cloud view and design list filters are optional exploded string arrays", () => {
  const { paths } = yaml.load(fs.readFileSync(cloudSpec, "utf8"));
  for (const [route, names] of [
    ["/api/content/views", ["visibility"]],
    ["/api/content/patterns", ["visibility", "populate"]],
  ]) {
    for (const name of names) {
      const param = paths[route].get.parameters.find((parameter) => parameter.name === name);
      assert.ok(param, `${route} defines ${name}`);
      assert.equal(param.in, "query");
      assert.notEqual(param.required, true);
      assert.equal(param.schema.type, "array", `${route} ${name}`);
      assert.equal(param.schema.items.type, "string");
      assert.equal(param.style, "form");
      assert.equal(param.explode, true);
    }
  }
});

test("generated Cloud list requests send separate values for repeated filters", async (t) => {
  const temporary = fs.mkdtempSync(path.join(root, "_openapi_build/cloud-list-query-"));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const outputFile = path.join(temporary, "cloud.ts");
  await generateEndpoints({
    schemaFile: cloudSpec,
    apiFile: path.join(root, "typescript/rtk/api.ts"),
    apiImport: "cloudBaseApi",
    outputFile,
    exportName: "cloudApi",
    filterEndpoints: ["getViews", "getPatterns"],
    hooks: false,
  });
  guardOptionalQueryParams(outputFile);

  const prefix = process.env.RTK_CLOUD_ENDPOINT_PREFIX;
  process.env.RTK_CLOUD_ENDPOINT_PREFIX = "https://example.test";
  t.after(() => {
    if (prefix === undefined) delete process.env.RTK_CLOUD_ENDPOINT_PREFIX;
    else process.env.RTK_CLOUD_ENDPOINT_PREFIX = prefix;
  });
  require("esbuild-runner/register");
  const { cloudApi } = require(outputFile);
  const store = configureStore({
    reducer: { [cloudApi.reducerPath]: cloudApi.reducer },
    middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(cloudApi.middleware),
  });
  t.after(() => store.dispatch(cloudApi.util.resetApiState()));

  let requestUrl;
  t.mock.method(globalThis, "fetch", async (request) => {
    requestUrl = new URL(request.url);
    return Response.json({});
  });
  async function request(endpoint, arg, route) {
    requestUrl = undefined;
    await store.dispatch(cloudApi.endpoints[endpoint].initiate(arg, { subscribe: false })).unwrap();
    assert.equal(requestUrl.pathname, route);
    return requestUrl.searchParams;
  }

  await t.test("view visibility", async () => {
    const params = await request("getViews", { visibility: ["public", "private"] }, "/api/content/views");
    assert.deepEqual(params.getAll("visibility"), ["public", "private"]);
  });
  await t.test("design visibility and populate", async () => {
    const filters = { visibility: ["published", "private"], populate: ["metadata", "user"] };
    const params = await request("getPatterns", filters, "/api/content/patterns");
    assert.deepEqual(
      { visibility: params.getAll("visibility"), populate: params.getAll("populate") },
      filters,
    );
  });
  await t.test("optional filters and scalar parameters", async () => {
    const params = await request("getViews", { page: 0, shared: false, search: "a + b" }, "/api/content/views");
    assert.deepEqual(Object.fromEntries(params), { search: "a + b", page: "0", shared: "false" });
  });
});
