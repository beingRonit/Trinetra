const boot = document.getElementById('entry-boot');
const minBootTime = 5000;
const start = Date.now();

const finishBoot = async () => {
  sessionStorage.setItem('trinetra_entry_boot_done', 'true');
  await import('/src/main.tsx');
  const elapsed = Date.now() - start;
  const remaining = Math.max(0, minBootTime - elapsed);

  window.setTimeout(() => {
    boot?.classList.add('is-hidden');
    window.setTimeout(() => boot?.remove(), 320);
  }, remaining);
};

void finishBoot();
