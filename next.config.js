/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Enable unstable_after() so the recording endpoint can transcribe in the
  // background after responding to Yemot (Next.js 14.2).
  experimental: { after: true },
};

module.exports = nextConfig;
