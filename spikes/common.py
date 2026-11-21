"""Utilitaires partagés par les scripts de la phase S."""
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).parent
OUT = ROOT / "out"
OUT.mkdir(exist_ok=True)
load_dotenv(ROOT / ".env")

# Tarifs Gemini en USD par million de tokens (standard), vérifiés le 13/11/2026.
PRICES = {
    "gemini-4-hydrogen": (1.50, 7.50),
    "gemini-3.8-flash": (0.75, 3.75),  # promo jusqu'au 31/12/2026, puis 1.50 / 7.50
    "gemini-3.5-flash-lite": (0.30, 2.50),
}


def require(*names: str) -> dict:
    missing = [n for n in names if not os.getenv(n)]
    if missing:
        sys.exit(f"Variables manquantes dans spikes/.env : {', '.join(missing)}")
    return {n: os.environ[n] for n in names}


def usage_report(model: str, usage) -> dict:
    """Transforme usage_metadata en tokens + coût estimé."""
    if usage is None:
        return {}
    # En mode agentique, les tokens vidéo inspectés par les outils sont comptés à part
    inp = (usage.prompt_token_count or 0) + (getattr(usage, "tool_use_prompt_token_count", 0) or 0)
    out = (usage.candidates_token_count or 0) + (usage.thoughts_token_count or 0)
    pin, pout = PRICES.get(model, (0, 0))
    return {
        "input_tokens": inp,
        "output_tokens_incl_thinking": out,
        "thinking_tokens": usage.thoughts_token_count or 0,
        "tool_use_prompt_tokens": getattr(usage, "tool_use_prompt_token_count", 0) or 0,
        "total_token_count": usage.total_token_count or 0,
        "raw": {k: v for k, v in usage.model_dump(exclude_none=True).items() if not isinstance(v, list)},
        "cost_usd": round(inp / 1e6 * pin + out / 1e6 * pout, 5),
    }


def save_json(name: str, data) -> Path:
    path = OUT / name
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return path
