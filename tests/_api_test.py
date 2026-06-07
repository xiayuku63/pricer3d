"""Quick full-flow API test for pricer3d."""
import json, sys, requests

BASE = "http://localhost:5000"

# 1. Admin login
print("=== 1. Admin Login ===")
r = requests.post(f"{BASE}/api/auth/admin-login")
assert r.status_code == 200, f"Login failed: {r.text}"
token = r.json()["access_token"]
headers = {"Authorization": f"Bearer {token}"}
print(f"  ✅ Token obtained: {token[:20]}...")

# 2. Get printers
print("\n=== 2. List Printers ===")
r = requests.get(f"{BASE}/api/slicer/printers", headers=headers)
print(f"  Status: {r.status_code}")
if r.status_code == 200:
    printers = r.json()
    print(f"  ✅ Found {len(printers)} printers")
else:
    print(f"  ⚠️ {r.text[:200]}")

# 3. Get printer presets
print("\n=== 3. Printer Presets ===")
r = requests.get(f"{BASE}/api/printer/presets", headers=headers)
print(f"  Status: {r.status_code}")
if r.status_code == 200:
    presets = r.json().get("presets", [])
    print(f"  ✅ Found {len(presets)} presets")
    for p in presets[:3]:
        print(f"    - {p.get('name','?')} (id={p.get('id')})")
else:
    print(f"  ⚠️ {r.text[:200]}")

# 4. Quote test cube
print("\n=== 4. Quote Test Cube ===")
test_file = "tests/fixtures/test_cube_20mm.stl"
try:
    with open(test_file, "rb") as f:
        r = requests.post(f"{BASE}/api/quote", headers=headers, files={"files": f}, data={
            "material": "PLA", "quantity": 1, "color": "White",
            "layer_height": 0.2, "infill": 20, "wall_count": 3
        })
except FileNotFoundError:
    print("  ❌ Test file not found")
    sys.exit(1)

print(f"  Status: {r.status_code}")
if r.status_code == 200:
    data = r.json()
    results = data.get("results", [])
    print(f"  ✅ Got {len(results)} result(s)")
    for res in results:
        fname = res.get("filename", "?")
        status = res.get("status")
        if status == "success":
            sp = res.get("_printer_speed_params")
            print(f"    ✅ {fname}: ¥{res.get('cost_cny',0)} | {res.get('estimated_time_h',0)}h")
            print(f"       Speed params: {sp}")
            print(f"       Status display: 成功")
        else:
            print(f"    ❌ {fname}: {res.get('error','')}")
else:
    print(f"  ❌ {r.text[:300]}")

# 5. Check response structure for frontend rendering
print("\n=== 5. Response Structure Check ===")
if r.status_code == 200:
    res = results[0] if results else {}
    checks = {
        "filename": res.get("filename"),
        "status": res.get("status"),
        "cost_cny": res.get("cost_cny"),
        "estimated_time_h": res.get("estimated_time_h"),
        "cost_breakdown": "present" if res.get("cost_breakdown") else "missing",
        "_printer_speed_params": res.get("_printer_speed_params"),
        "dimensions": res.get("dimensions"),
    }
    for k, v in checks.items():
        print(f"  {k}: {v}")

# 6. Test size validation - need a big model
print("\n=== 6. Size Validation Test (theoretical) ===")
print("  ℹ️  Size validation added in calculator/cost.py")
print("  ℹ️  Would need a model > 256mm to trigger failure")

print("\n=== ALL TESTS DONE ===")
