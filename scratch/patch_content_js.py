# patch_content_js.py
import os

file_path = r"d:/codex xoay/AutoRegUnified/content.js"

with open(file_path, "r", encoding="utf-8", errors="replace") as f:
    content = f.read()

# Locate the exact OTP Page block
target = """    // OTP Page
    const otpInput = document.querySelector("input[name='code'], input#code, input[autocomplete='one-time-code']");
    if (otpInput && otpInput.offsetParent !== null && (!job.otpFilled || otpInput.value === "")) {"""

if target in content:
    print("Found target block. Finding end of block...")
    # Find the closing brace of the if block
    # In content.js, after if (otpInput ...) there is setTimeout(runLoop, 3000); return; }
    # Let's find the closing brace that matches the if block.
    # We can replace the code from '    // OTP Page' to '    // Email Page' directly!
    
    start_idx = content.find("    // OTP Page")
    end_idx = content.find("    // Email Page")
    
    if start_idx != -1 and end_idx != -1:
        replacement = """    // OAuth Authorization Page
    if (url.includes("auth.openai.com/authorize") || url.includes("auth0.com/authorize")) {
      const authBtn = Array.from(document.querySelectorAll("button")).find(b => 
        /authorize|allow|continue|đồng ý|cho phép|chấp nhận/i.test(b.textContent.trim().toLowerCase()) && 
        isVisible(b) && !b.disabled
      );
      if (authBtn) {
        log("Phát hiện trang OAuth, đang tự động bấm Authorize...");
        clickLikeUser(authBtn);
        setTimeout(runLoop, 2000);
        return;
      }
    }

    // OTP Page (Email verification or 2FA)
    const otpInput = document.querySelector("input[name='code'], input#code, input[autocomplete='one-time-code'], input[name='totp_otp']");
    if (otpInput && otpInput.offsetParent !== null && (!job.otpFilled || otpInput.value === "")) {
      const pageText = document.body.innerText.toLowerCase();
      const isMfa = pageText.includes("authenticator") || pageText.includes("auth app") || pageText.includes("ứng dụng xác thực") || otpInput.name === "totp_otp" || pageText.includes("2fa");

      if (isMfa && job.secret) {
        log("Phát hiện trang 2FA, đang tự động sinh mã xác thực từ Secret...");
        const code = await getTOTP(job.secret);
        if (code) {
          await reactFill(otpInput, code);
          log(`Điền 2FA OTP: ${code}`);
          await updateJob({ otpFilled: true, lastOtpCode: code, lastActionAt: Date.now() });
          setTimeout(() => {
            const btn = (document.querySelector("button[type='submit']") || Array.from(document.querySelectorAll("button")).find(b => /continue|next|verify|xác minh/i.test(b.textContent.trim().toLowerCase())));
            if (btn) btn.click();
          }, 1000);
        }
      } else {
        log("Đang lấy mã OTP từ Email...");
        chrome.runtime.sendMessage({ type: "FETCH_OTP", email: job.email, mailSite: job.mailSite }, async (res) => {
          if (res && res.code) {
            await reactFill(otpInput, res.code);
            log(`Điền OTP: ${res.code}`);
            await updateJob({ otpFilled: true, lastOtpCode: res.code, lastActionAt: Date.now() });
            setTimeout(() => {
              const btn = (document.querySelector("button[type='submit']") || Array.from(document.querySelectorAll("button")).find(b => /continue|next/i.test(b.textContent)));
              if (btn) btn.click();
            }, 1000);
          }
        });
      }
      setTimeout(runLoop, 3000);
      return;
    }

"""
        new_content = content[:start_idx] + replacement + content[end_idx:]
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(new_content)
        print("Successfully patched content.js!")
    else:
        print("Could not find start or end index.")
else:
    print("Target block not found.")
