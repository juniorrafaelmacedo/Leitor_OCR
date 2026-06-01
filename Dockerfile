# Use a secure, lightweight official Node.js image
FROM node:20-slim AS builder
WORKDIR /app

# Ensure security updates are applied
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*

# Copy dependency files
COPY package*.json ./

# Install ALL dependencies (needed to build)
RUN npm ci

# Copy the rest of the application files
COPY . .

# Build the frontend (Vite) and backend bundle (esbuild) to /dist
RUN npm run build

# --- Production Image Stage ---
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

# Copy compiled files and descriptors
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist

# Install ONLY production dependencies for security and speed
RUN npm ci --only=production

# Cloud Run defaults to exposing traffic on 8080, but can be configured to other ports.
# We expose 3000 as our app default port.
EXPOSE 3000

# Command to launch the bundled production server
CMD ["npm", "start"]
