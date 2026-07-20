/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // pdfjs-dist is loaded client-side only (dynamic import inside useEffect).
  // Alias the optional Node-only `canvas` dependency to an empty module so the
  // bundler never tries to resolve it.
  turbopack: {
    resolveAlias: {
      canvas: './scripts/empty-module.js',
    },
  },
};

export default nextConfig;
