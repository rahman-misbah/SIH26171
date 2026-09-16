export default defineContentScript({
  // The agent must be able to act on whatever page the user is on; egress is
  // controlled separately via optional_host_permissions (SPEC §12.4, §13.4).
  matches: ['<all_urls>'],
  main() {
    // DOM extraction, element registry, action executor arrive in M5/M6.
  },
});
