FROM python:3.13-slim

# - ffmpeg : encodage MP3 des capsules (phase 2) ;
# - LibreOffice Impress (sans Java) : POST /pptx-to-pdf ;
# - polices métriquement compatibles Office (Carlito ≈ Calibri, Caladea ≈
#   Cambria, Liberation ≈ Arial/Times) pour ne pas décaler les schémas.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ffmpeg \
        libreoffice-impress \
        fonts-dejavu-core fonts-liberation fonts-crosextra-carlito fonts-crosextra-caladea \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8080
WORKDIR /srv

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

RUN useradd --create-home --uid 10001 worker
USER worker

EXPOSE 8080
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --workers 1"]
