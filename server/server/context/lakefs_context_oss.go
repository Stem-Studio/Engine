//go:build oss

package context

// EnsureLakeFSBucketExists is a no-op in the open-source AI server. The oss
// build tag intentionally excludes the generated LakeFS client and remote
// asset pipeline.
func EnsureLakeFSBucketExists() error {
	return nil
}
