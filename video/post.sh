#!/bin/bash
# Post-process the Quantum Sentinel demo recording:
# trim to the good part, crop off the browser chrome (content starts y=87),
# scale to 1280x720, add caption overlays, append an end card.
# Captions use textfile= so commas/colons in the text need no escaping.
set -e
cd ~/workspace/qorechain/quantum-sentinel/video

FONT=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf
CAP="fontfile=$FONT:fontsize=26:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=14:x=(w-text_w)/2:y=h-90"

printf '%s' 'Quantum Sentinel - post-quantum allowance agent' > cap1.txt
printf '%s' 'Agent status: 100 QOR, PQC key registered, EVM window LIVE' > cap2.txt
printf '%s' 'The policy: 0.1 QOR/tx, 0.5 QOR/day, 10 txs/day, whitelist' > cap3.txt
printf '%s' 'Policy playground: would the agent do it?' > cap4.txt
printf '%s' '0.05 QOR to the owner - ALLOW' > cap5.txt
printf '%s' '5 QOR exceeds the 0.1 QOR per-tx cap - REJECT' > cap6.txt
printf '%s' 'Off-whitelist destination - REJECT' > cap7.txt
printf '%s' 'Activity log: every decision, executed or rejected' > cap8.txt
printf '%s' 'ML-DSA-87: sign a command, verify OK' > cap9.txt
printf '%s' 'Tampered payload: verify FAILS, request rejected' > cap10.txt

ffmpeg -y -v error -i raw.mp4 -vf \
"trim=5.5:69.0,setpts=PTS-STARTPTS,crop=1280:713:0:87,scale=1280:720,drawtext=textfile=cap1.txt:$CAP:enable='between(t,1,9)',drawtext=textfile=cap2.txt:$CAP:enable='between(t,9,15)',drawtext=textfile=cap3.txt:$CAP:enable='between(t,15,21)',drawtext=textfile=cap4.txt:$CAP:enable='between(t,21,25)',drawtext=textfile=cap5.txt:$CAP:enable='between(t,25,31)',drawtext=textfile=cap6.txt:$CAP:enable='between(t,31,37)',drawtext=textfile=cap7.txt:$CAP:enable='between(t,37,42)',drawtext=textfile=cap8.txt:$CAP:enable='between(t,42,47)',drawtext=textfile=cap9.txt:$CAP:enable='between(t,51,56)',drawtext=textfile=cap10.txt:$CAP:enable='between(t,56,61)'" \
-c:v libx264 -preset medium -pix_fmt yuv420p -r 30 -an segment.mp4

ffmpeg -y -v error -f lavfi -i color=c=0x150a33:s=1280x720:d=3 -vf \
"drawtext=text='Quantum Sentinel':fontfile=$FONT:fontsize=56:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2-70,drawtext=text='quantum-sentinel.vercel.app':fontfile=$FONT:fontsize=30:fontcolor=#c4b5fd:x=(w-text_w)/2:y=(h-text_h)/2+10,drawtext=text='QoreChain Developer Fest - Post-Quantum AI Agents':fontfile=$FONT:fontsize=24:fontcolor=#e9d5ff:x=(w-text_w)/2:y=(h-text_h)/2+70" \
-c:v libx264 -preset medium -pix_fmt yuv420p -r 30 -an endcard.mp4

printf "file 'segment.mp4'\nfile 'endcard.mp4'\n" > concat.txt
ffmpeg -y -v error -f concat -safe 0 -i concat.txt -c copy -movflags +faststart ../public/demo-video.mp4
ffprobe -v error -show_entries format=duration,size -of default=noprint_wrappers=1 ../public/demo-video.mp4
ffprobe -v error -select_streams v:0 -show_entries stream=width,height,codec_name,pix_fmt,r_frame_rate -of default=noprint_wrappers=1 ../public/demo-video.mp4
echo OK
