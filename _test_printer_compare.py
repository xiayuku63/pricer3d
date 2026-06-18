import json, subprocess, urllib.request, os

os.chdir("/d/Projects/pricer3d")

# Step 1: Get admin token
req = urllib.request.Request(
    "http://127.0.0.1:5001/api/auth/admin-login",
    data=b"app_env=development",
    headers={"Content-Type": "application/x-www-form-urlencoded"}
)
resp = urllib.request.urlopen(req)
data = json.loads(resp.read())
token = data.get("access_token") or data.get("token") or ""
print(f"TOKEN OK" if token else "NO TOKEN")

auth_header = f"Authorization: Bearer ***# Test with A1
for printer in ["bambu_a1", "bambu_x1c"]:
    r = subprocess.run([
        "curl", "-s", "-X", "POST", "http://127.0.0.1:5001/api/quote",
        "-H", auth_header,
        "-F", "files=@tests/fixtures/test_cube_20mm.stl",
        "-F", f"printer_model={printer}",
        "-F", "material=PLA",
        "-F", "color=#000000",
        "-F", "quantity=1",
        "-F", "use_prusaslicer=true",
        "-F", "layer_height=0.2",
        "-F", "infill=20",
        "-F", "wall_count=3"
    ], capture_output=True, text=True, timeout=120)
    d = json.loads(r.stdout)
    item = d["results"][0]
    print(f"{printer}: time={item.get('estimated_time_h','?')}h cost={item.get('cost_cny','?')} weight={item.get('weight_g','?')}g")
