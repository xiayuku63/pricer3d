"""Test: compare A1 vs X1C slice time with correction=1.0"""
import json, subprocess, sys, os

os.chdir("/d/Projects/pricer3d")

# Step 1: Get debug token by simulating the debug login
# The debug login uses ?debug param in browser. Let's try admin-login with POST
import urllib.request

# Try to get token via the page debug mode - POST to admin-login
req = urllib.request.Request(
    "http://127.0.0.1:5001/api/auth/admin-login",
    data=b"",
    headers={"Content-Type": "application/x-www-form-urlencoded"}
)
try:
    resp = urllib.request.urlopen(req)
    data = json.loads(resp.read())
    token = data.get("access_token") or data.get("token") or ""
    print(f"Token obtained: {bool(token)}")
except Exception as e:
    print(f"Admin login failed: {e}")
    # Try regular login
    req2 = urllib.request.Request(
        "http://127.0.0.1:5001/api/auth/login",
        data=json.dumps({"username": "admin", "password": "admin"}).encode(),
        headers={"Content-Type": "application/json"}
    )
    try:
        resp2 = urllib.request.urlopen(req2)
        data2 = json.loads(resp2.read())
        token = data2.get("access_token") or data2.get("token") or ""
        print(f"Regular login token: {bool(token)}")
    except Exception as e2:
        print(f"Regular login also failed: {e2}")
        sys.exit(1)

if not token:
    print("No token")
    sys.exit(1)

# Step 2: Test with A1 vs X1C
test_file = "tests/fixtures/test_cube_20mm.stl"
results = {}

for printer in ["bambu_a1", "bambu_x1c"]:
    cmd = [
        "curl", "-s", "-X", "POST", "http://127.0.0.1:5001/api/quote",
        "-H", "Authorization: Bearer " + token,
        "-F", "files=@" + test_file,
        "-F", "printer_model=" + printer,
        "-F", "material=PLA",
        "-F", "color=#000000",
        "-F", "quantity=1",
        "-F", "use_prusaslicer=true",
        "-F", "layer_height=0.2",
        "-F", "infill=20",
        "-F", "wall_count=3"
    ]
    print(f"\nSlicing with {printer}...")
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    print(f"exit={result.returncode}")
    
    try:
        data = json.loads(result.stdout)
        if "results" in data:
            item = data["results"][0]
            t = item.get("estimated_time_h", "?")
            c = item.get("cost_cny", "?")
            w = item.get("weight_g", "?")
            pm = item.get("_printer_model", "?")
            print(f"  {printer}: time={t}h cost={c} weight={w}g printer={pm} status={item.get('status','?')}")
            results[printer] = {"time": t, "cost": c, "weight": w}
        else:
            print(f"  Response: {json.dumps(data, indent=2)[:500]}")
    except Exception as e:
        print(f"  Parse error: {e}")
        print(f"  Raw: {result.stdout[:300]}")

if len(results) == 2:
    t1 = results["bambu_a1"]["time"]
    t2 = results["bambu_x1c"]["time"]
    print(f"\n=== Comparison ===")
    print(f"  A1:  {t1}h")
    print(f"  X1C: {t2}h")
    if t1 == t2:
        print(f"  ⚠️ Times are IDENTICAL")
    else:
        print(f"  ✅ Times differ")
