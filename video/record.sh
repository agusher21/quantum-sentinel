#!/bin/bash
# Record the Quantum Sentinel demo: Xvfb + ffmpeg x11grab + puppeteer driver.
set -u
cd /home/hatch/workspace/qorechain/quantum-sentinel/video

Xvfb :99 -screen 0 1280x800x24 > xvfb.log 2>&1 &
XVFB_PID=$!
sleep 2

DISPLAY=:99 ffmpeg -y -v error -f x11grab -video_size 1280x800 -framerate 30 -i :99 -c:v libx264 -preset ultrafast -pix_fmt yuv420p raw.mp4 > ffmpeg-record.log 2>&1 &
FF_PID=$!
sleep 2

DISPLAY=:99 node /home/hatch/workspace/qorechain/quantum-sentinel/video/driver.cjs 2>&1 | tee driver.log

kill "$FF_PID" 2>/dev/null
sleep 2
kill "$XVFB_PID" 2>/dev/null
sleep 1
ls -la raw.mp4
ffprobe -v error -show_entries format=duration,size -of default=noprint_wrappers=1 raw.mp4
echo RECORD-DONE
