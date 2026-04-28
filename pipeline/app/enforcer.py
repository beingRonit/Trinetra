from .evidence import build_evidence
from .notice import generate_notice
from .mailer import send_email

AUTO_SEND = False  # 🔥 keep False for safety


def process_takedown(input_path, best_result, target_url, email_config):
    evidence = build_evidence(input_path, best_result)

    notice = generate_notice(evidence, target_url)

    print("\n📄 NOTICE PREVIEW:\n")
    print(notice)

    # 🚨 strict condition (don't spam)
    if best_result["final"] < 90:
        print("⚠️ Not sending: confidence too low")
        return

    if not AUTO_SEND:
        print("🛑 Manual approval required")
        return

    send_email(
        email_config["sender"],
        email_config["password"],
        email_config["recipient"],
        "Copyright Notice",
        notice
    )

    print("📤 Notice sent")