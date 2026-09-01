"""Load assistant settings"""
import os

from dotenv import load_dotenv

load_dotenv()

# Load settings
api_key = os.getenv("API_KEY")

client = None

# Verify settings
if not api_key:
    raise ValueError("No API key found!")