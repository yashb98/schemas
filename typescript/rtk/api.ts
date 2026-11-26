import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import { withMeshkitErrorTransform } from "./meshkitError";
import { prepareCloudHeaders } from "./currentOrgHeader";

// The MeshKit error surface lives in ./meshkitError so it can be unit-tested
// without loading the React-coupled RTK runtime this module pulls in (see the
// module doc there). Re-exported here so `@meshery/schemas/api` consumers keep
// importing these from the same place; tsup inlines them into the `api` bundle.
export {
  withMeshkitErrorTransform,
  type MeshkitError,
  type MeshkitFetchBaseQueryError,
} from "./meshkitError";

export const SUPPORTED_SOCIAL_ACCOUNTS = ["github", "google"];

export { CURRENT_ORG_KEY } from "./currentOrgHeader";
export const DEFAULT_DESIGN_VERSION = "0.0.1";
export const MESHERY_PROD_URL = "https://playground.meshery.io/";

// Environment variable defaults
const CLOUD_BASE_URL = process.env.RTK_CLOUD_ENDPOINT_PREFIX ?? "";
const MESHERY_BASE_URL = process.env.RTK_MESHERY_ENDPOINT_PREFIX ?? "";

const cloudQueryOptions = {
  baseUrl: CLOUD_BASE_URL,
  credentials: "include" as const,
  prepareHeaders: prepareCloudHeaders,
};

const baseQueryCloud = fetchBaseQuery(cloudQueryOptions);
const baseQueryCloudWithRepeatedParams = fetchBaseQuery({
  ...cloudQueryOptions,
  paramsSerializer: (params) => {
    const query = new URLSearchParams();
    for (const [name, value] of Object.entries(params)) {
      if (value === undefined) continue;
      const values = Array.isArray(value) ? value : [value];
      for (const item of values) {
        query.append(name, String(item));
      }
    }
    return query.toString();
  },
});

const queryCloud: typeof baseQueryCloud = (args, api, extraOptions) => {
  // These list operations read each visibility or populate value separately.
  const baseQuery = api.endpoint === "getViews" || api.endpoint === "getPatterns"
    ? baseQueryCloudWithRepeatedParams
    : baseQueryCloud;
  return baseQuery(args, api, extraOptions);
};

// Wrap with MeshKit error transform so endpoint consumers can read
// error?.meshkit.suggestedRemediation etc.
const baseQueryCloudWithMeshkit = withMeshkitErrorTransform(queryCloud);
const baseQueryMesheryWithMeshkit = withMeshkitErrorTransform(
  fetchBaseQuery({ baseUrl: MESHERY_BASE_URL, credentials: "include" }),
);

// API 1: Cloud Provider API
export const cloudBaseApi = createApi({
  reducerPath: "cloudRtkSchemasApi",
  baseQuery: baseQueryCloudWithMeshkit,
  tagTypes: [],
  endpoints: () => ({}),
});

// API 2: Meshery API
export const mesheryBaseApi = createApi({
  reducerPath: "mesheryRtkSchemasApi",
  baseQuery: baseQueryMesheryWithMeshkit,
  tagTypes: [],
  endpoints: () => ({}),
});
