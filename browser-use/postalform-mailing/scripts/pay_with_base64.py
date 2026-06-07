#!/usr/bin/env python3
"""Pay PostalForm MPP order via base64 PDF + pre-approved SPT.

Usage:
    python3 pay_with_base64.py <pdf_path> <spt_token> <payload_json_path>
    
    Where payload_json_path is a JSON file containing the full MPP order payload
    (with pdf field being "data:application/pdf;base64,..."). If the PDF field
    is a local path, this script base64-encodes it automatically.

Environment:
    - mppx must be installed (node): cd /tmp/mppx_temp && npm init -y && npm install mppx
    - mppx_gen.js must exist at /tmp/mppx_gen.js
    - Node.js must be on PATH

Exit codes: 0 = paid, 1 = payment failed (SPT expired, etc.), 2 = needs approval
"""
import json, uuid, base64, subprocess, re, sys, os

ENDPOINT = 'https://postalform.com/api/machine/mpp/orders'
MPPX_SCRIPT = '/tmp/mppx_gen.js'
HEADERS_PATH = '/tmp/mpp_402_headers.txt'

def base64_encode_pdf(path):
    with open(path, 'rb') as f:
        b64 = base64.b64encode(f.read()).decode('ascii')
    assert '\n' not in b64, "Newlines in base64 — encode in Python, not shell"
    return f"data:application/pdf;base64,{b64}"

def post_and_get_challenge(payload_path):
    """POST payload, return (http_code, body, headers_text)."""
    result = subprocess.run([
        'curl', '-s', '-w', '\n%{http_code}', '-D', HEADERS_PATH,
        '-H', 'Content-Type: application/json',
        '-d', f'@{payload_path}', ENDPOINT
    ], capture_output=True, text=True, timeout=60)
    lines = result.stdout.strip().split('\n')
    http_code = lines[-1].strip()
    body = '\n'.join(lines[:-1]) if len(lines) > 1 else ''
    with open(HEADERS_PATH) as f:
        headers = f.read()
    return http_code, body, headers

def extract_stripe_challenge(headers_text):
    """Extract method=stripe challenge from WWW-Authenticate headers."""
    auth_headers = re.findall(
        r'www-authenticate:\s*(Payment[^\r\n]+)', 
        headers_text, re.IGNORECASE
    )
    for h in auth_headers:
        if 'method="stripe"' in h:
            return h.strip()
    return None

def serialize_credential(challenge, spt):
    """Run mppx_gen.js to get Authorization header."""
    result = subprocess.run(
        ['node', MPPX_SCRIPT, challenge, spt],
        capture_output=True, text=True, timeout=30
    )
    if result.returncode != 0:
        raise RuntimeError(f"mppx_gen.js failed: {result.stderr}")
    return result.stdout.strip()

def retry_with_auth(payload_path, auth_header):
    """Retry POST with Authorization header."""
    result = subprocess.run([
        'curl', '-s', '-w', '\n%{http_code}',
        '-H', 'Content-Type: application/json',
        '-H', f'Authorization: {auth_header}',
        '-d', f'@{payload_path}', ENDPOINT
    ], capture_output=True, text=True, timeout=60)
    lines = result.stdout.strip().split('\n')
    http_code = lines[-1].strip()
    body = '\n'.join(lines[:-1]) if len(lines) > 1 else ''
    return http_code, body

def main():
    if len(sys.argv) < 3:
        print(f"Usage: {sys.argv[0]} <pdf_path> <spt_token> [payload_json_path]")
        print("If payload_json_path omitted, builds minimal payload with manual addresses.")
        sys.exit(1)
    
    pdf_path = sys.argv[1]
    spt = sys.argv[2]
    
    if len(sys.argv) >= 4:
        # Load existing payload, replace pdf with base64 if needed
        with open(sys.argv[3]) as f:
            payload = json.load(f)
        pdf_val = payload.get('pdf', '')
        if not pdf_val.startswith('data:'):
            payload['pdf'] = base64_encode_pdf(pdf_path)
            payload['request_id'] = payload.get('request_id', str(uuid.uuid4()))
    else:
        print("Need payload_json_path for addresses. Use full MPP payload.")
        sys.exit(1)
    
    # Ensure request_id exists
    if 'request_id' not in payload:
        payload['request_id'] = str(uuid.uuid4())
    
    # Save payload
    payload_path = '/tmp/mpp_payment_payload.json'
    with open(payload_path, 'w') as f:
        json.dump(payload, f)
    
    print(f"Order request_id: {payload['request_id']}")
    
    # Step 1: POST → get 402
    http_code, body, headers = post_and_get_challenge(payload_path)
    print(f"Initial response: HTTP {http_code}")
    
    if http_code not in ('402',):
        print(f"Unexpected response: {body[:500]}")
        sys.exit(1)
    
    # Step 2: Extract challenge
    challenge = extract_stripe_challenge(headers)
    if not challenge:
        print("No Stripe challenge in WWW-Authenticate headers")
        sys.exit(1)
    print(f"Challenge: {challenge[:100]}...")
    
    # Step 3: Serialize credential
    try:
        auth_header = serialize_credential(challenge, spt)
        print(f"Auth header: {auth_header[:80]}...")
    except RuntimeError as e:
        print(f"mppx error: {e}")
        sys.exit(1)
    
    # Step 4: Retry with auth
    http_code, body = retry_with_auth(payload_path, auth_header)
    print(f"Payment response: HTTP {http_code}")
    
    try:
        data = json.loads(body)
        order_id = data.get('order_id') or data.get('id', 'N/A')
        is_paid = data.get('is_paid', False)
        status = data.get('status', 'N/A')
        
        print(f"order_id: {order_id}")
        print(f"is_paid: {is_paid}")
        print(f"status: {status}")
        
        if is_paid:
            print("PAID ✓")
            sys.exit(0)
        elif 'PaymentIntent failed' in body or 'verification-failed' in body:
            print("SPT expired/invalid — needs fresh spend-request")
            print(f"order_id for recovery: {order_id}")
            sys.exit(2)
        else:
            sys.exit(1)
    except json.JSONDecodeError:
        print(f"Raw: {body[:500]}")
        sys.exit(1)

if __name__ == '__main__':
    main()
