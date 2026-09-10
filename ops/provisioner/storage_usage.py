"""Read-only upload directory measurement. No deletion, enforcement or mail."""
import os
import stat
import time


def upload_bytes(path):
    config = path / 'bookstack'
    if path.is_symlink() or config.is_symlink() or not config.is_dir():
        return None
    total = 0
    seen = set()
    # Current LinuxServer uploads + private attachments; legacy layout also supported.
    for relative in ('www/uploads', 'www/files', 'files'):
        root = config / relative
        if any(p.is_symlink() for p in [root, *root.parents][:len(root.relative_to(config).parts)]):
            continue
        if not root.exists():
            continue
        for directory, dirs, files in os.walk(root, followlinks=False, onerror=lambda error: (_ for _ in ()).throw(error)):
            dirs[:] = [d for d in dirs if not (root.__class__(directory) / d).is_symlink()]
            for name in files:
                info = (root.__class__(directory) / name).lstat()
                if stat.S_ISREG(info.st_mode) and (info.st_dev, info.st_ino) not in seen:
                    total += info.st_size
                    seen.add((info.st_dev, info.st_ino))
    return total


def record_storage(db, ident, path, instance, measured_at=None):
    # A slow tenant is scanned at most every 15 minutes; failed reads retain an
    # explicitly unknown value and never interrupt lifecycle reconciliation.
    try:
        if measured_at is not None and 0 <= time.time() - measured_at.timestamp() < 900:
            return
        measured = upload_bytes(path)
    except OSError:
        measured = None
    db.execute("UPDATE tenants SET storage_used_bytes=%s,storage_measured_at=now() WHERE COALESCE(provisioner_instance,'production')=%s AND id=%s",
               (measured, instance, ident))
