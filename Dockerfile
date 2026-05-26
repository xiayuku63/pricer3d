FROM ubuntu:24.04

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-venv python3-pip \
    ca-certificates \
    xvfb libfuse2t64 \
    libwebkit2gtk-4.1-0 libosmesa6 \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# PrusaSlicer for headless slicing
RUN apt-get update && apt-get install -y --no-install-recommends prusa-slicer \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN python3 -m venv /app/venv && \
    /app/venv/bin/pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p /app/data/uploads /app/data/outputs /app/data/user

COPY deploy/docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 5000
ENTRYPOINT ["docker-entrypoint.sh"]
