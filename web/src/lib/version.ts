export const version = () => process.env.PXLS_VERSION ?? "dev";
export const revision = () => process.env.PXLS_GIT_SHA ?? "unknown";
