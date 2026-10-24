FROM dart:stable AS build
WORKDIR /app
COPY pubspec.* ./
RUN dart pub get
COPY . .
RUN dart analyze
RUN dart test
RUN dart compile exe bin/server.dart -o bin/server

FROM debian:bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl libstdc++6 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /runtime/ /
COPY --from=build /app/bin/server /app/server
RUN mkdir -p /data/private-documents && useradd --system --uid 10001 --home-dir /nonexistent --shell /usr/sbin/nologin dealer \
    && chown -R dealer:dealer /data/private-documents /app
USER dealer
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD curl -fsS http://127.0.0.1:8080/health >/dev/null || exit 1
ENTRYPOINT ["/app/server"]
