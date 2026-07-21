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

# Install PrusaSlicer CLI from GitHub Release AppImage
# Note: Prusa3D stopped shipping Linux AppImage starting from v2.9.3,
# so we use the last available Linux build v2.8.1
RUN wget -q -O /usr/local/bin/prusa-slicer.AppImage \
    "https://github.com/prusa3d/PrusaSlicer/releases/download/version_2.8.1/PrusaSlicer-2.8.1+linux-x64-newer-distros-GTK3-202409181416.AppImage" \
    && chmod +x /usr/local/bin/prusa-slicer.AppImage \
    && ln -sf /usr/local/bin/prusa-slicer.AppImage /usr/local/bin/prusa-slicer

# AppImage needs extraction in Docker (no FUSE available)
ENV APPIMAGE_EXTRACT_AND_RUN=1

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
