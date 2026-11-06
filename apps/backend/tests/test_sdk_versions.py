"""Regression guard for the Anthropic SDK version pin.

Staging silently drifted to `anthropic==2.6.0` + `langchain-anthropic==1.7.10`
because `apps/backend/Dockerfile` installed via `pip install -e .` against a
floating `langchain-anthropic>=0.3` (ignoring `uv.lock`). Under anthropic 2.x
every `ChatAnthropic(..., temperature=0)` call routes through `beta.messages`,
which rejects `temperature` with HTTP 400
`invalid_request_error: "temperature: Extra inputs are not permitted"`, so the
ficha web search (and all extraction calls) failed in production.

These asserts encode the known-good range verified by live reproduction:
anthropic 0.x works, anthropic 2.x breaks; langchain-anthropic 1.5.x works,
1.7.x breaks. They fail loudly if a build drifts back into the broken major.
"""

from importlib.metadata import version


def _major(v: str) -> int:
    return int(v.split(".", 1)[0])


def _minor(v: str) -> int:
    parts = v.split(".")
    return int(parts[1]) if len(parts) > 1 else 0


def test_anthropic_sdk_below_breaking_major():
    """anthropic 2.x rejects `temperature` on beta.messages — stay on 0.x."""
    v = version("anthropic")
    assert _major(v) < 1, (
        f"anthropic=={v} is >=1.0; anthropic 2.x rejects the `temperature` "
        "parameter on beta.messages (HTTP 400). Pin anthropic<1.0 until "
        "langchain-anthropic ships verified support for the newer major."
    )


def test_langchain_anthropic_on_known_good_minor():
    """langchain-anthropic 1.7.x sends `temperature` to the beta endpoint that
    rejects it; 1.5.x does not. Stay below 1.6."""
    v = version("langchain-anthropic")
    major, minor = _major(v), _minor(v)
    assert (major, minor) < (1, 6), (
        f"langchain-anthropic=={v} is >=1.6; 1.7.x breaks Claude web_search by "
        "sending `temperature` to beta.messages. Pin langchain-anthropic<1.6."
    )
