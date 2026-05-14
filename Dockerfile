FROM ubuntu:24.04

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-venv python3-pip \
    ca-certificates \
    xvfb libfuse2t64 \
    libwebkit2gtk-4.1-0 libosmesa6 \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# PrusaSlicer for headless slicing (replaces Bambu Studio which requires Wayland)
RUN apt-get update && apt-get install -y --no-install-recommends prusa-slicer \
    && rm -rf /var/lib/apt/lists/*

# Bambu Studio AppImage (optional - replaces Bambu Studio which requires Wayland)
# Copy a dummy file first; real deployment should provide the actual AppImage
COPY bambu.AppImage /tmp/
RUN if [ "$(stat -c%s /tmp/bambu.AppImage 2>/dev/null || echo 0)" -gt 10000000 ]; then \
        echo "Installing Bambu Studio from AppImage..."; \
        chmod +x /tmp/bambu.AppImage && \
        cd /tmp && /tmp/bambu.AppImage --appimage-extract && \
        mkdir -p /opt/bambu-studio && \
        cp -r /tmp/squashfs-root/* /opt/bambu-studio/ && \
        rm -rf /tmp/squashfs-root /tmp/bambu.AppImage; \
    else \
        echo "bambu.AppImage not found, skipping Bambu Studio (will use PrusaSlicer only)"; \
        echo '#!/bin/sh\necho bambu-studio not available; exit 1' > /usr/local/bin/bambu-studio; \
        chmod +x /usr/local/bin/bambu-studio; \
    fi

# Verify and symlink bambu-studio if installed
RUN if [ -d /opt/bambu-studio ]; then \
        BIN=$(find /opt/bambu-studio -name "bambu-studio" -type f | head -1); \
        [ -n "$BIN" ] && chmod +x "$BIN" && ln -sf "$BIN" /usr/local/bin/bambu-studio; \
    fi

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
