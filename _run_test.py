"""Test A1 vs X1C using urllib only"""
import urllib.request, urllib.parse, json, os, sys

os.chdir("D:/Projects/pricer3d")

# Get token
req = urllib.request.Request(
    "http://127.0.0.1:5001/api/auth/admin-login",
    data=b"{}",
    headers={"Content-Type": "application/json"}
)
resp = urllib.request.urlopen(req)
data = json.loads(resp.read())
token = data.get("access_token", "")
print("Token:", token[:20] + "...")

# Test each printer
boundary = "----TestBoundary12345"
results = {}

for printer in ["bambu_a1", "bambu_x1c"]:
    print("\n>>>", printer)
    
    # Build multipart form data manually  
    with open("tests/fixtures/test_cube_20mm.stl", "rb") as f:
        file_data = f.read()
    
    body = []
    def add_field(name, value):
        body.append("--" + boundary)
        body.append("Content-Disposition: form-data; name=\"" + name + "\"")
        body.append("")
        body.append(value)
    
    add_field("printer_model", printer)
    add_field("material", "PLA")
    add_field("color", "#000000")
    add_field("quantity", "1")
    add_field("use_prusaslicer", "true")
    add_field("layer_height", "0.2")
    add_field("infill", "20")
    add_field("wall_count", "3")
    
    # File part
    body.append("--" + boundary)
    body.append("Content-Disposition: form-data; name=\"files\"; filename=\"test.stl\"")
    body.append("Content-Type: application/sla")
    body.append("")
    
    full_body = "\r\n".join(body).encode("utf-8") + b"\r\n" + file_data + ("\r\n--" + boundary + "--\r\n").encode("utf-8")
    
    req = urllib.request.Request(
        "http://127.0.0.1:5001/api/quote",
        data=full_body,
        headers={
            "Content-Type": "multipart/form-data; boundary=" + boundary,
            "Authorization": "Bearer " + token,
        },
        method="POST"
    )
    
    try:
        resp = urllib.request.urlopen(req, timeout=180)
        d = json.loads(resp.read())
        item = d["results"][0]
        t = item.get("estimated_time_h", "?")
        s = item.get("status", "?")
        w = item.get("weight_g", "?")
        print("  time=" + str(t) + "h weight=" + str(w) + "g status=" + str(s))
        results[printer] = t
    except urllib.error.HTTPError as e:
        print("  HTTP Error:", e.code, e.read().decode()[:300])

print("\n=== COMPARISON ===")
print("A1: ", results.get("bambu_a1", "?"), "h")
print("X1C:", results.get("bambu_x1c", "?"), "h")
a1 = results.get("bambu_a1")
x1c = results.get("bambu_x1c")
if a1 is not None and x1c is not None:
    if a1 == x1c:
        print("⚠️ IDENTICAL - printer NOT affecting time!")
    else:
        diff = abs(float(a1) - float(x1c)) if isinstance(a1, (int, float)) and isinstance(x1c, (int, float)) else "?"
        print("✅ DIFFERENT (diff=" + str(diff) + "h)")
