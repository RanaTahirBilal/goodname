# The product, runnable where Node 26 is not installed.
#
# Node 26 is not optional here and not a preference: the engine ships
# TypeScript source and relies on type stripping to run it, which is why
# there is no build step for `packages/domain`. An older base image fails
# with what look like syntax errors in our own code.
#
# Two stages, for the ordinary reason: the build needs devDependencies and
# the running image should not carry them.

# ---------------------------------------------------------------- build
FROM node:26-bookworm-slim AS build

WORKDIR /app

# Manifests first, so a change to source code does not reinstall the world.
COPY package.json package-lock.json ./
COPY packages/domain/package.json packages/domain/
COPY packages/persistence/package.json packages/persistence/
COPY apps/website/package.json apps/website/

RUN npm ci

COPY . .

RUN npm run build --workspace @rep/website

# -------------------------------------------------------------- runtime
FROM node:26-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4300

# The database is a file, so it needs a path that outlives the container.
# Declared here rather than left to the caller: a SQLite database written
# into the container filesystem is deleted by the next deploy, and the
# failure mode is every customer's audits quietly disappearing.
ENV REP_DB_PATH=/data/rep.db
VOLUME /data

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/website ./apps/website

RUN npm ci --omit=dev --ignore-scripts

# Not root. The process writes to /data and nothing else, and a container
# that can rewrite its own application is a larger blast radius than this
# needs.
RUN mkdir -p /data && chown -R node:node /data /app
USER node

EXPOSE 4300

# The health check is the one in the app, which asks whether the database
# answers and whether the background worker is running. A container that
# serves pages while its worker is dead looks healthy to anything checking
# the port, and would queue audits for ever.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4300)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

WORKDIR /app/apps/website
CMD ["npx", "next", "start", "--port", "4300", "--hostname", "0.0.0.0"]
