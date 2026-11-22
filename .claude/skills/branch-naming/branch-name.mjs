// branch-name.mjs - checks a git branch name against this repo's rule: <type>--<description>, no "/".
// The types are the Conventional Commits types, so a branch and its commits share one list.
import { TYPES } from '../conventional-commits/conventional-commits.mjs';

export const SEPARATOR = '--';
const DESCRIPTION = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Returns an array of { rule, message }. An empty array means the name conforms.
export function validateBranchName(name) {
  if (name === '') return [{ rule: 'branch-empty', message: 'the branch name is empty' }];

  const violations = [];
  if (name.includes('/')) {
    violations.push({ rule: 'branch-slash', message: '"/" makes git store the branch as a directory path; use "--"' });
  }

  const index = name.indexOf(SEPARATOR);
  if (index === -1) {
    violations.push({ rule: 'branch-separator', message: `no "${SEPARATOR}" between the type and the description` });
    return violations;
  }

  const type = name.slice(0, index);
  const description = name.slice(index + SEPARATOR.length);
  if (!TYPES.includes(type)) {
    violations.push({ rule: 'branch-type-enum', message: `"${type}" is not one of: ${TYPES.join(', ')}` });
  }
  if (!DESCRIPTION.test(description)) {
    violations.push({
      rule: 'branch-description',
      message: `"${description}" is not lowercase words of a-z and 0-9 joined by single "-"`,
    });
  }
  return violations;
}
