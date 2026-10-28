#import <XCTest/XCTest.h>
#include <string.h>
#include "kernel/calls.h"

extern const char *uname_hostname_override;

@interface DSHUnameTests : XCTestCase
@end

@implementation DSHUnameTests

- (void)testLongHostnameIsTruncatedWithoutCorruptingUname {
    char name[1024];
    memset(name, 'h', sizeof(name) - 1);
    name[sizeof(name) - 1] = '\0';

    const char *previous = uname_hostname_override;
    uname_hostname_override = name;
    struct uname result;
    do_uname(&result);
    uname_hostname_override = previous;

    XCTAssertEqual(result.hostname[sizeof(result.hostname) - 1], '\0');
    XCTAssertEqual(strlen(result.hostname), sizeof(result.hostname) - 1);
    XCTAssertEqual(strncmp(result.hostname, name, sizeof(result.hostname) - 1), 0);
    XCTAssertEqual(strcmp(result.release, "4.20.69-ish"), 0);
    XCTAssertEqual(strcmp(result.domain, "(none)"), 0);
}

@end
