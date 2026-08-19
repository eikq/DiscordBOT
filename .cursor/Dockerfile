# Cursor Cloud Agent base image. Do not COPY the project; Cursor checks out the commit.
FROM node:22-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    git \
    python3 \
    python3-pip \
    python3-venv \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*
