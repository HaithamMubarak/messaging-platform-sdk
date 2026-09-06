from setuptools import setup, find_packages
from pathlib import Path

here = Path(__file__).parent

# Required distribution inputs: omission must fail the build, not erase metadata.
long_description = (here / "README.md").read_text(encoding="utf-8")

requirements = [r.strip() for r in (here / "requirements.txt").read_text(encoding="utf-8").splitlines()
                if r.strip() and not r.strip().startswith("#")]

setup(
    name="hmdev-messaging-agent",
    version="1.0.0",
    description="Messaging Platform - Python Agent package (TCP control server and helpers)",
    long_description=long_description,
    long_description_content_type="text/markdown",
    author="HaithamMubarak",
    packages=find_packages(exclude=("tests", "tests.*")),
    include_package_data=True,
    install_requires=requirements,
    python_requires=">=3.10",
    classifiers=[
        "Programming Language :: Python :: 3",
        "License :: OSI Approved :: MIT License",
        "Operating System :: OS Independent",
    ],
    entry_points={
        "console_scripts": [
            # Provide a convenient CLI to start the TCP-only agent entrypoint
            "hmdev-agent = hmdev.messaging.agent:main",
        ],
    },
)
