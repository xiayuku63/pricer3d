"""Get token via debug login then test A1 vs X1C slicing"""
import urllib.request, json, subprocess, os, sys

# Try admin-login
try:
    req = urllib.request.Request(
        "http://127.0.0.1:5001/api/auth/admin-login",
        data=b"{}",
        headers={"Content-Type": "application/json"}
    )
    resp = urllib.request.urlopen(req)
    data = json.loads(resp.read())
    print("admin-login response keys:", list(data.keys()))
    token = data.get("access_token") or data.get("token") or ""
except Exception as e:
    print("admin-login failed:", e)
    try:
        body = e.read().decode()
        print("  body:", body[:300])
    except:
        pass
    # Try form-urlencoded
    try:
        req2 = urllib.request.Request(
            "http://127.0.0.1:5001/api/auth/admin-login",
            data=b"app_env=development",
            headers={"Content-Type": "application/x-www-form-urlencoded"}
        )
        resp2 = urllib.request.urlopen(req2)
        data2 = json.loads(resp2.read())
        print("form-login response keys:", list(data2.keys()))
        token = data2.get("access_token") or data2.get("token") or ""
    except Exception as e2:
        print("form-login also failed:", e2)
        try:
            body2 = e2.read().decode()
            print("  body:", body2[:300])
        except:
            pass
        sys.exit(1)

if not token:
    print("No token obtained")
    sys.exit(1)

print("Token obtained, length:", len(token))

os.chdir("/d/Projects/pricer3d")
test_file = "tests/fixtures/test_cube_20mm.stl"

auth_hdr = "Authorization: Bearer " + token

for printer in ["bambu_a1", "bambu_x1c"]:
    print("\n>>> Testing", printer, "...")
    cmd = [
        "curl", "-s", "-w", "\n%{http_code}", "-X", "POST",
        "http://127.0.0.1:5001/api/quote",
        "-H", auth_hdr,
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
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    output = r.stdout.strip()
    lines = output.split("\n")
    http_code = lines[-1] if lines else "?"
    body = "\n".join(lines[:-1])
    
    print("  HTTP", http_code)
    try:
        d = json.loads(body)
        if "results" in d:
            item = d["results"][0]
            print("  time =", item.get('estimated_time_h', '?'), "h")
            print("  cost =", item.get('cost_cny', '?'))
            print("  weight =", item.get('weight_g', '?'), "g")
            print("  printer_model =", item.get('_printer_model', '?'))
            print("  status =", item.get('status', '?'))
        else:
            print("  body:", body[:500])
    except Exception as ex:
        print("  parse error:", ex)
        print("  raw:", body[:500])
