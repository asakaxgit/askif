import { isAskError, makeAskError } from "askif";
import type { GoogleAuth } from "google-auth-library";

const CLOUD_PLATFORM = "https://www.googleapis.com/auth/cloud-platform";

let authPromise: Promise<GoogleAuth> | undefined;

const loadAuth = async (): Promise<GoogleAuth> => {
  const sdk = await import("google-auth-library").catch((error: unknown) => {
    throw makeAskError(
      "BACKEND_UNAVAILABLE",
      "Vertex ADC needs google-auth-library. Install it with: npm install google-auth-library",
      error,
    );
  });
  return new sdk.GoogleAuth({ scopes: [CLOUD_PLATFORM] });
};

const getAuth = (): Promise<GoogleAuth> =>
  (authPromise ??= loadAuth().catch((error: unknown) => {
    authPromise = undefined;
    throw error;
  }));

/**
 * A Google access token from Application Default Credentials.
 * Called on every Vertex request. The auth library refreshes the token when it expires;
 * this module does not cache a static key.
 */
export const getAdcAccessToken = async (): Promise<string> => {
  try {
    const token = await (await getAuth()).getAccessToken();
    if (token === null || token === undefined || token.trim() === "") {
      throw makeAskError("BACKEND_UNAVAILABLE", "ADC returned an empty access token.");
    }
    return token;
  } catch (error) {
    if (isAskError(error)) throw error;
    const message = error instanceof Error ? error.message : "token lookup failed";
    throw makeAskError(
      "BACKEND_UNAVAILABLE",
      `Google ADC access token unavailable: ${message.slice(0, 200)}`,
      error,
    );
  }
};
