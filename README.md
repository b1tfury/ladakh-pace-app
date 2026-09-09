# Ladakh Pace

Mobile pace + elevation calculator for the Ladakh Marathon (full).

## Run locally
```
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 10000
```

## GPX source
Course geometry from the official Google My Map “Marathon Route Map 2023” (embedded on the race site). Elevation from OpenTopoData Mapzen DEM on densified vertices (see `/api/course` source fields).

## Model
Naismith-inspired climb-equivalent: +1 km flat per 100 m gain; -0.3 km per 100 m drop.

## Render
Web service `ladakh-pace`, Python, free plan, health `/health`.
