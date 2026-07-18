# Use the official Apify Python base image
ARG PYTHON_VERSION=3.11
FROM apify/actor-python:${PYTHON_VERSION}

# Copy requirements and install dependencies
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy the source code
COPY . ./

# Run the actor
CMD ["python3", "-m", "src.main"]
