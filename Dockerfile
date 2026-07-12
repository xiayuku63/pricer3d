FROM ubuntu:24.04

# Install system dependencies (including headless GUI for Three.js)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-venv python3-pip \
    ca-certificates \
    wget \
    xvfb libfuse2t64 \
    libwebkit2gtk-4.1-0 libosmesa6 \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install PrusaSlicer v2.9.6 CLI from GitHub release
RUN wget -q -O /tmp/prusa.deb \
    "https://github.com/prusa3d/PrusaSlicer/releases/download/version_2.9.6/PrusaSlicer-2.9.6+linux-x64-GTK3-202503061506.deb" \
    && apt-get update && apt-get install -y --no-install-recommends /tmp/prusa.deb \
    && rm -f /tmp/prusa.deb \
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
