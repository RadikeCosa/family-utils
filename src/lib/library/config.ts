// Read only from server entry points; never expose the environment variable to the client.
export function libraryEnabled() { return process.env.LIBRARY_ENABLED === "true"; }
export function availabilityEnabled() { return libraryEnabled() && process.env.LIBRARY_AVAILABILITY_ENABLED === "true"; }
