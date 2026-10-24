FROM rocker/r2u:24.04@sha256:dc2a96c3b368969635c25c177c64514ba8e37cf2259dd3584de7c33520191d92
RUN apt-get update && apt-get install -y --no-install-recommends r-cran-lme4 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /analysis
ENTRYPOINT ["Rscript"]
