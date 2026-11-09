// Read only from server entry points; never expose the environment variable to the client.
export function libraryEnabled() { return process.env.LIBRARY_ENABLED === "true"; }
