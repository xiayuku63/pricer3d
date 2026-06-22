import os, glob, time

# Find the very latest G-code files
user_dir = '/app/data/user/user_3_admin/outputs'
gcodes = []
for date_dir in os.listdir(user_dir):
    full_date = os.path.join(user_dir, date_dir)
    if not os.path.isdir(full_date):
        continue
    for d in os.listdir(full_date):
        job_dir = os.path.join(full_date, d)
        if not os.path.isdir(job_dir):
            continue
        gcode = os.path.join(job_dir, d + '.gcode')
        if os.path.isfile(gcode):
            mtime = os.path.getmtime(gcode)
            size = os.path.getsize(gcode)
            gcodes.append((mtime, size, gcode, d))

# Sort by mtime, newest first
gcodes.sort(reverse=True)
print("Latest 10 G-code files:")
for mtime, size, path, name in gcodes[:10]:
    ts = time.strftime('%H:%M:%S', time.localtime(mtime))
    print(f"  {ts}  {size:>10d}  {name[:40]}")
