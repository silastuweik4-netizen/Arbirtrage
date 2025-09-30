import requests
import time
import os

# 🔑 Telegram bot setup
TELEGRAM_TOKEN = os.getenv("TELEGRAM_TOKEN")
CHAT_ID = os.getenv("CHAT_ID")  # Your personal chat or group ID

SOLEND_API = "https://api.solend.fi/v1/markets?scope=mainnet"

# Store already-alerted owners
alerted = {}

def send_telegram(msg: str, owner: str):
    if not TELEGRAM_TOKEN or not CHAT_ID:
        print("⚠️ Missing Telegram credentials")
        return
    
    url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
    
    # 🔗 Inline buttons
    buttons = {
        "inline_keyboard": [[
            {"text": "🔎 View on Solscan", "url": f"https://solscan.io/account/{owner}"},
            {"text": "📊 View Solend", "url": "https://solend.fi"}
        ]]
    }

    payload = {
        "chat_id": CHAT_ID,
        "text": msg,
        "reply_markup": buttons,
        "parse_mode": "Markdown"
    }

    try:
        requests.post(url, json=payload, timeout=10)
    except Exception as e:
        print(f"⚠️ Telegram error: {e}")

def fetch_liquidations():
    try:
        resp = requests.get(SOLEND_API, timeout=10)
        data = resp.json()

        obligations = []
        for market in data:
            reserves = {r["reserveAddress"]: r for r in market.get("reserves", [])}

            for obligation in market.get("obligations", []):
                hf = float(obligation.get("healthFactor", 1.0))
                borrowed = obligation.get("borrowedValue", 0) or 0
                collateral = obligation.get("collateralValue", 0) or 0

                if hf < 1.0 and borrowed > 0:
                    # Estimate liquidatable value = min(borrowed, collateral)
                    liquidatable_value = min(borrowed, collateral)

                    # Default bonus
                    liquidation_bonus = 0.05  

                    # Try to get more accurate liquidation bonus from reserves
                    if obligation.get("deposits"):
                        deposit = obligation["deposits"][0]
                        reserve_addr = deposit["reserveAddress"]
                        reserve_info = reserves.get(reserve_addr)
                        if reserve_info and "liquidationBonus" in reserve_info:
                            # Usually stored like "105" = 5% bonus
                            bonus_raw = float(reserve_info["liquidationBonus"])
                            liquidation_bonus = (bonus_raw - 100) / 100  

                    profit_estimate = liquidatable_value * liquidation_bonus

                    obligations.append({
                        "owner": obligation["owner"],
                        "hf": hf,
                        "borrowed": borrowed,
                        "collateral": collateral,
                        "liquidatable": liquidatable_value,
                        "bonus": liquidation_bonus,
                        "profit": profit_estimate
                    })
        return obligations
    except Exception as e:
        print(f"⚠️ Error fetching Solend data: {e}")
        return []

def run():
    print("🚀 Solana Liquidation Watcher with Dynamic PnL started...")
    while True:
        liquidations = fetch_liquidations()
        current_alerts = set()

        if liquidations:
            for l in liquidations:
                owner = l["owner"]
                current_alerts.add(owner)

                # Only send if new OR previously recovered
                if owner not in alerted or alerted[owner] is False:
                    msg = (f"🚨 *Liquidation Opportunity Detected!*\n\n"
                           f"👤 *Owner:* `{owner}`\n"
                           f"📉 *Health Factor:* {l['hf']:.2f}\n"
                           f"💸 *Borrowed:* ${l['borrowed']:.2f}\n"
                           f"🏦 *Collateral:* ${l['collateral']:.2f}\n"
                           f"⚖️ *Liquidatable:* ${l['liquidatable']:.2f}\n"
                           f"💰 *Est. Profit (@{l['bonus']*100:.1f}% bonus):* ${l['profit']:.2f}")
                    send_telegram(msg, owner)
                    alerted[owner] = True

        # Reset owners that recovered (HF back ≥ 1)
        for owner in list(alerted.keys()):
            if owner not in current_alerts:
                alerted[owner] = False

        time.sleep(30)  # check every 30s

if __name__ == "__main__":
    run()
