# Fun

A collection of single-file browser toys and tools, served straight from
GitHub Pages: <https://twrconsultingllc.github.io/Fun/>

## Testing

`tests/` holds a dependency-light regression suite. It currently covers
`tricalc.html` with 112 assertions.

```bash
cd tests
npm install
npm test           # test the working copy
npm run test:live  # test what is deployed
```

See [tests/README.md](tests/README.md) for what is covered and how to add more.
