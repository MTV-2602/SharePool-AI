self.__BUILD_MANIFEST = {
  "__rewrites": {
    "afterFiles": [
      {
        "source": "/v1/v1/:path*",
        "destination": "/api/v1/:path*"
      },
      {
        "source": "/v1/v1",
        "destination": "/api/v1"
      },
      {
        "source": "/codex/:path*",
        "destination": "/api/v1/responses"
      },
      {
        "source": "/v1/:path*",
        "destination": "/api/v1/:path*"
      },
      {
        "source": "/v1",
        "destination": "/api/v1"
      }
    ],
    "beforeFiles": [],
    "fallback": []
  },
  "sortedPages": [
    "/_app",
    "/_error"
  ]
};self.__BUILD_MANIFEST_CB && self.__BUILD_MANIFEST_CB()