/** Immutable inputs for the live CLI acceptance tests. */
export const repositories = [
  { repository: 'JetBrains/MPS', commit: 'd7e4f5c1394535b05e90dde6e3e7e8a3f3e174a2', snapshot: 'mps' },
  // The commit adding writing-lint-checks; later commits remove the bundled skills.
  { repository: 'JetBrains/android', commit: '4d9ec3e52b338aa1c962c1ff0421cc62db5c73af', snapshot: 'android' },
  { repository: 'JetBrains/koog', commit: '22e342e033c716f835312dd6cbe83193e1cbcf76', snapshot: 'koog' },
] as const;
