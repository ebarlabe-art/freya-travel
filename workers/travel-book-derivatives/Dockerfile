FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app
RUN pip install --no-cache-dir fastapi==0.116.1 'uvicorn[standard]==0.35.0' httpx==0.28.1 Pillow==11.3.0 pillow-heif==1.1.0
COPY app.py .

CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT:-8080} --workers 1"]
