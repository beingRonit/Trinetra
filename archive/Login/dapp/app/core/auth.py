from fastapi import HTTPException, Request
import jwt
import os
from typing import Optional


SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")
APP_AUTH_SECRET = os.getenv("APP_AUTH_SECRET", "")
CLERK_JWKS_URL = os.getenv("CLERK_JWKS_URL", "https://api.clerk.com/v1/jwks")
CLERK_JWT_ISSUER = os.getenv("CLERK_JWT_ISSUER", "")


def _verify_clerk_token(token: str) -> Optional[dict]:
    try:
        header = jwt.get_unverified_header(token)
        if header.get("alg") != "RS256":
            return None

        unverified_payload = jwt.decode(
            token,
            options={
                "verify_signature": False,
                "verify_exp": False,
                "verify_nbf": False,
                "verify_iat": False,
                "verify_aud": False,
                "verify_iss": False,
            },
            algorithms=["RS256"],
        )
        issuer = CLERK_JWT_ISSUER or unverified_payload.get("iss")
        if not issuer:
            raise HTTPException(status_code=401, detail="Invalid Clerk token issuer")

        jwk_client = jwt.PyJWKClient(CLERK_JWKS_URL)
        signing_key = jwk_client.get_signing_key_from_jwt(token)
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            issuer=issuer,
            options={"verify_aud": False},
        )

        if payload.get("sub"):
            return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except HTTPException:
        raise
    except Exception:
        return None

    return None


async def verify_token(request: Request) -> Optional[dict]:
    """Verify app or Supabase JWT token. Returns user payload if valid, None if no token."""
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        return None

    token = auth_header.replace("Bearer ", "")
    if not token:
        return None

    if APP_AUTH_SECRET:
        try:
            payload = jwt.decode(
                token,
                APP_AUTH_SECRET,
                algorithms=["HS256"],
                audience="trinetra-users",
            )
            if payload.get("token_type") == "access":
                return payload
        except jwt.ExpiredSignatureError:
            raise HTTPException(status_code=401, detail="Token expired")
        except jwt.InvalidTokenError:
            pass

    clerk_payload = _verify_clerk_token(token)
    if clerk_payload:
        return clerk_payload

    if SUPABASE_JWT_SECRET:
        try:
            payload = jwt.decode(
                token,
                SUPABASE_JWT_SECRET,
                algorithms=["HS256"],
                audience="authenticated",
            )
            return payload
        except jwt.ExpiredSignatureError:
            raise HTTPException(status_code=401, detail="Token expired")
        except jwt.InvalidTokenError:
            raise HTTPException(status_code=401, detail="Invalid token")

    return None


async def require_auth(request: Request) -> dict:
    """Require authentication. Raises 401 if not authenticated."""
    user = await verify_token(request)
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user
