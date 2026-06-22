"""Test A1 vs X1C using requests library"""
import requests, json, os, sys

os.chdir("/d/Projects/pricer3d")

# Get debug token
r = requests.post("http://127.0.0.1:5001/api/auth/admin-login", json={})
if r.status_code != 200:
    print("Admin login failed:", r.status_code, r.text[:300])
    sys.exit(1)
token = r.json().get("access_token", "")
print("Token:", token[:20] + "...")

headers = {"Authorization": "Bearer *** + token
test_file = "tests/fixtures/test_cube_20mm.stl"

results = {}
for printer in ["bambu_a1", "bambu_x1c"]:
    print("\n>>> Testing " + printer + "...")
    with open(test_file, "rb") as f:
        r = requests.post(
            "http://127.0.0.1:5001/api/quote",
            headers=headers,
            files={"files": ("test_cube_20mm.stl", f, "application/sla")},
            data={
                "printer_model": printer,
                "material": "PLA",
                "color": "#000000",
                "quantity": "1",
                "use_prusaslicer": "true",
                "layer_height": "0.2",
                "infill": "20",
                "wall_count": "3"
            },
            timeout=180
        )
    print("  HTTP", r.status_code)
    data = r.json()
    if "results" in data:
        item = data["results"][0]
        t = item.get("estimated_time_h", "?")
        c = item.get("cost_cny", "?")
        w = item.get("weight_g", "?")
        pm = item.get("_printer_model", "?")
        st = item.get("status", "?")
        print("  time=" + str(t) + "h cost=" + str(c) + " weight=" + str(w) + "g printer=" + str(pm) + " status=" + str(st))
        results[printer] = t
    else:
        print("  Response:", json.dumps(data, ensure_ascii=False)[:500])

if len(results) == 2:
    print("\n=== COMPARISON ===")
    print("  A1:  " + str(results["bambu_a1"]) + "h")
    print("  X1C: " + str(results["bambu_x1c"]) + "h")
    if results["bambu_a1"] == results["bambu_x1c"]:
        print("  ⚠️ IDENTICAL - printer not affecting time!")
    else:
        print("  ✅ DIFFERENT")
