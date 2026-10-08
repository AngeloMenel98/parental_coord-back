// ESLint config aligned with @nestjs/cli defaults
module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: 'tsconfig.json',
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint/eslint-plugin'],
  extends: [
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
  ],
  root: true,
  env: {
    node: true,
    jest: true,
  },
  ignorePatterns: ['.eslintrc.js'],
  rules: {
    '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
  },

  overrides: [
  {
    // Business layer never touches typeorm. Entities/repos/modules are NOT matched.
    files: ['src/**/*.service.ts', 'src/**/*.controller.ts', 'src/**/*.scheduler.ts'],
    excludedFiles: ['*.spec.ts'],   // belt+braces
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          { name: 'typeorm', message: 'Capa de negocio no importa typeorm: inyecta el repositorio dedicado de tu módulo.' },
          { name: '@nestjs/typeorm', message: 'InjectRepository/@nestjs/typeorm sólo en src/**/repositories/ y *.module.ts.' },
        ],
        patterns: [{ group: ['typeorm/*'], message: 'Pasa por un repositorio dedicado (BaseRepository).' }],
      }],
    },
  },
],
};