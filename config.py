"""Load assistant settings"""
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()
BASE_PATH = Path(__file__).resolve().parent

# Load settings
# API Key
API_KEY = os.getenv("API_KEY")

# System prompt
_system_prompt_file = BASE_PATH / "system_prompt.txt"
if not _system_prompt_file.is_file():
    raise FileNotFoundError("system_prompt.txt doesn't exist")

with open(_system_prompt_file, "r") as file:
    SYSTEM_PROMPT = file.read()

# Initialize client

CLIENT = None

# Verify settings
if not API_KEY:
    raise ValueError("No API key found!")