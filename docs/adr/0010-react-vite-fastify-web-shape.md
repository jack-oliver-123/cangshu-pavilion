# Use a React SPA with a Fastify HTTP host

The browser application will be a React single-page application built with Vite, while Fastify provides the HTTP and SSE interface and serves the built assets in production. The product has no search-engine or server-rendering requirement, so it will avoid an additional Next.js server and proxy layer; Fastify remains an HTTP Adapter and does not replace the application Plugin Kernel.
