"""Packing several numpy arrays into one HTTP response.

Layout: 4-byte little-endian header length, a JSON header (space-padded so the
data starts on an 8-byte boundary), then the arrays back to back, each padded
to 8 bytes so the browser can view them as typed arrays in place. The header's
``arrays`` list gives each one's name, dtype (numpy style: ``u1``, ``u2``,
``f4``…), shape and byte offset from the start of the data.
"""
from __future__ import annotations

import json
from typing import Dict, List, Tuple

import numpy as np


def pack(header: Dict, arrays: List[Tuple[str, np.ndarray]]) -> bytes:
    entries, chunks, offset = [], [], 0
    for name, arr in arrays:
        arr = np.ascontiguousarray(arr)
        if arr.dtype.byteorder == ">":
            arr = arr.astype(arr.dtype.newbyteorder("<"))
        raw = arr.tobytes()
        entries.append({"name": name, "dtype": arr.dtype.str.lstrip("<|="), "shape": list(arr.shape),
                        "offset": offset, "bytes": len(raw)})
        pad = (-len(raw)) % 8
        chunks.append(raw + b"\0" * pad)
        offset += len(raw) + pad
    text = json.dumps({**header, "arrays": entries}).encode()
    text += b" " * ((-(4 + len(text))) % 8)
    return len(text).to_bytes(4, "little") + text + b"".join(chunks)
