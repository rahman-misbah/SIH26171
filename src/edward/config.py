"""Load assistant settings"""
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()
BASE_PATH = Path.cwd().parent.parent

# Load settings
# API Key
API_KEY = os.getenv("API_KEY")

# System prompt
system_prompt_file = BASE_PATH / "system_prompt.txt"
if not system_prompt_file.is_file():
    raise FileNotFoundError("system_prompt.txt doesn't exist")

with open("system_prompt_file", "r") as file:
    SYSTEM_PROMPT = file.read()

# Initialize client

CLIENT = None

# Verify settings
if not api_key:
    raise ValueError("No API key found!")